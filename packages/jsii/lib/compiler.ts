import Case = require('case');
import colors = require('colors/safe');
import fs = require('fs-extra');
import log4js = require('log4js');
import path = require('path');
import ts = require('typescript');
import { Assembler } from './assembler';
import { EmitResult, Emitter } from './emitter';
import { ProjectInfo } from './project-info';
import utils = require('./utils');

const COMPILER_OPTIONS: ts.CompilerOptions = {
    alwaysStrict: true,
    charset: 'utf8',
    declaration: true,
    experimentalDecorators: true,
    inlineSourceMap: true,
    inlineSources: true,
    jsx: ts.JsxEmit.React,
    jsxFactory: 'jsx.create',
    lib: ['lib.es2016.d.ts', 'lib.es2017.object.d.ts', 'lib.es2017.string.d.ts'],
    module: ts.ModuleKind.CommonJS,
    noEmitOnError: true,
    noFallthroughCasesInSwitch: true,
    noImplicitAny: true,
    noImplicitReturns: true,
    noImplicitThis: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    resolveJsonModule: true,
    strict: true,
    strictNullChecks: true,
    strictPropertyInitialization: false,
    target: ts.ScriptTarget.ES2018
};

const LOG = log4js.getLogger('jsii/compiler');
export const DIAGNOSTICS = 'diagnostics';

export interface CompilerOptions {
    /** The information about the project to be built */
    projectInfo: ProjectInfo;
    /** Whether the compiler should watch for changes or just compile once */
    watch: boolean;
}

export class Compiler implements Emitter {
    public constructor(private readonly options: CompilerOptions) {}

    /**
     * Compiles the configured program.
     *
     * @param files can be specified to override the standard source code location logic. Useful for example when testing "negatives".
     */
    public async emit(...files: string[]): Promise<EmitResult | never> {
        if (this.options.watch) {
            if (files.length > 0) {
                throw new Error(`Files cannot be specified in watch mode!`);
            }
            return await this._startWatch();
        } else {
            if (files.length === 0) {
                files = await _findSourceFiles(this.options.projectInfo.projectRoot);
            }
            return await this._buildOnce(files);
        }
    }

    private async _buildOnce(files: string[]): Promise<EmitResult> {
        await this._writeTypeScriptConfig();
        const host = ts.createCompilerHost(COMPILER_OPTIONS);
        host.getCurrentDirectory = () => this.options.projectInfo.projectRoot;
        const prog = ts.createProgram(
            files.concat(_pathOfLibraries(host)),
            COMPILER_OPTIONS,
            host
        );
        return await this._consumeProgram(prog);
    }

    private async _startWatch(): Promise<never> {
        return new Promise<never>(async () => {
            const projectRoot = this.options.projectInfo.projectRoot;
            const host = ts.createWatchCompilerHost(
                await this._writeTypeScriptConfig(),
                COMPILER_OPTIONS,
                { ...ts.sys, getCurrentDirectory() { return projectRoot; } }
            );
            const orig = host.afterProgramCreate;
            host.afterProgramCreate = async builderProgram => {
                await this._consumeProgram(builderProgram.getProgram());
                if (orig) { orig.call(host, builderProgram); }
            };
            ts.createWatchProgram(host);
            // Previous call never returns
        });
    }

    private async _consumeProgram(program: ts.Program): Promise<EmitResult> {
        const emit = program.emit();
        if (emit.emitSkipped) {
            LOG.error('Compilation errors prevented the JSII assembly from being created');
            return emit;
        }
        const assembler = new Assembler(this.options.projectInfo, program);
        const assmEmit = await assembler.emit();
        if (assmEmit.emitSkipped) {
            LOG.error('Type model errors prevented the JSII assembly from being created');
        }
        return {
            emitSkipped: assmEmit.emitSkipped,
            diagnostics: [...emit.diagnostics, ...assmEmit.diagnostics]
        };
    }

    /**
     * Creates a `tsconfig.json` file to improve the IDE experience.
     *
     * @return the fully qualified path to the ``tsconfig.json`` file
     */
    private async _writeTypeScriptConfig(): Promise<string> {
        const commentKey = '_generated_by_jsii_';
        const commentValue = 'Generated by jsii - safe to delete, and ideally should be in .gitignore';
        const configPath = path.join(this.options.projectInfo.projectRoot, 'tsconfig.json');
        if (await fs.pathExists(configPath)) {
            const currentConfig = await fs.readJson(configPath);
            if (!(commentKey in currentConfig)) {
                // tslint:disable-next-line:max-line-length
                throw new Error(`A '${configPath}' file that was not generated by jsii is in ${this.options.projectInfo.projectRoot}. Aborting instead of overwriting.`);
            }
        }
        // tslint:disable-next-line:no-console
        LOG.debug(`Creating or updating ${colors.blue(configPath)}`);
        await fs.writeJson(configPath, {
            compilerOptions: {
                ...COMPILER_OPTIONS,
                // Need to stip the `lib.` prefix and `.d.ts` suffix
                lib: COMPILER_OPTIONS.lib && COMPILER_OPTIONS.lib.map(name => name.slice(4, name.length - 5)),
                // Those int-enums, we need to output the names instead
                module: COMPILER_OPTIONS.module && ts.ModuleKind[COMPILER_OPTIONS.module],
                target: COMPILER_OPTIONS.target && ts.ScriptTarget[COMPILER_OPTIONS.target],
                jsx: COMPILER_OPTIONS.jsx && Case.snake(ts.JsxEmit[COMPILER_OPTIONS.jsx]),
            },
            [commentKey]: commentValue
        }, {  replacer: utils.filterEmpty, spaces: 4 });
        return configPath;
    }
}

function _pathOfLibraries(host: ts.CompilerHost | ts.WatchCompilerHost<any>): string[] {
    if (!COMPILER_OPTIONS.lib || COMPILER_OPTIONS.lib.length === 0) { return []; }
    const lib = host.getDefaultLibLocation && host.getDefaultLibLocation();
    if (!lib) {
        throw new Error(`Compiler host doesn't have a default library directory available for ${COMPILER_OPTIONS.lib.join(', ')}`);
    }
    return COMPILER_OPTIONS.lib.map(name => path.join(lib, name));
}

const SOURCE_DIRS = new Set(['bin', 'lib', 'test']);
async function _findSourceFiles(dir: string, isRoot = true): Promise<string[]> {
    const result = new Array<string>();
    for (const name of await fs.readdir(dir)) {
        const file = path.join(dir, name);
        if ((await fs.stat(file)).isDirectory()) {
            // Only consider white-listed source-dirs when in the root.
            if (!isRoot || SOURCE_DIRS.has(name)) {
                result.push(...await _findSourceFiles(file, false));
            }
            continue;
        }
        if (!isRoot && name === 'tsconfig.json') {
            // Part of a different typescript project!
            return [];
        }
        if (!(name.endsWith('.ts') || name.endsWith('.tsx'))) { continue; }
        if (name.endsWith('.d.ts') || name.endsWith('.d.tsx')) { continue; }
        result.push(file);
    }
    return result;
}

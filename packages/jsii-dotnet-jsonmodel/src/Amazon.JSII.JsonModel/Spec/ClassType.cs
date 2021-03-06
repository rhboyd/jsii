﻿using Newtonsoft.Json;
using System;

namespace Amazon.JSII.JsonModel.Spec
{
    [JsonObject(MemberSerialization = MemberSerialization.OptIn)]
    public class ClassType : Type
    {
        public ClassType
        (
            // Type properties
            string fullyQualifiedName,
            string assembly,
            string name,

            // ClassType properties
            bool isAbstract,

            string @namespace = null,
            // Type properties
            Docs docs = null,

            // ClassType properties
            TypeReference @base = null,
            Method initializer = null,
            Property[] properties = null,
            Method[] methods = null,
            TypeReference[] interfaces = null
        )
            : base
            (
                fullyQualifiedName,
                assembly,
                name,
                @namespace,
                TypeKind.Class,
                docs
            )
        {
            IsAbstract = isAbstract;

            Base = @base;
            Initializer = initializer;
            Properties = properties;
            Methods = methods;
            Interfaces = interfaces;
        }

        [JsonProperty("abstract")]
        public bool IsAbstract { get; }

        [JsonProperty("base", NullValueHandling = NullValueHandling.Ignore)]
        public TypeReference Base { get; }

        [JsonProperty("initializer", NullValueHandling = NullValueHandling.Ignore)]
        public Method Initializer { get; }

        [JsonProperty("properties", NullValueHandling = NullValueHandling.Ignore)]
        public Property[] Properties { get; }

        [JsonProperty("methods", NullValueHandling = NullValueHandling.Ignore)]
        public Method[] Methods { get; }

        [JsonProperty("interfaces", NullValueHandling = NullValueHandling.Ignore)]
        public TypeReference[] Interfaces { get; }
    }
}

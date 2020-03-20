import * as graphql from "graphql";
import { buildSchemaFromTypeDefinitions } from "graphql-tools";
import { importSchema } from "graphql-import";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import Knex from "knex";
import { authorize } from "./auth";
import { Loader } from "./loader";

function buildSchema() {
  const typeDefs = importSchema("./schema.graphql", {});
  const schema = buildSchemaFromTypeDefinitions(typeDefs);
  const typeMap = schema.getTypeMap();
  Object.keys(typeMap).forEach(typeName => {
    if (!(typeMap[typeName] instanceof graphql.GraphQLObjectType)) return;
    const type = typeMap[typeName];
    if (type instanceof graphql.GraphQLObjectType) {
      const fields = type.getFields();
      Object.keys(fields).forEach(fieldName =>
        buildResolver(fieldName, fields[fieldName])
      );
    }
  });
  return schema;
}

function buildResolver(
  fieldName: string,
  field: graphql.GraphQLField<any, any, any>
) {
  if (field.astNode?.directives?.find(e => e.name.value == "hidden")) {
    field.resolve = () => {
      throw new Error("Forbidden accesss on @hidden field");
    };
  }
  if (field.resolve) return;
  const directive = field.astNode?.directives?.find(e =>
    ["table", "belongsTo", "hasMany"].includes(e.name.value)
  );
  if (!directive) return;
  const table = getDirectiveValue(directive, "table") || fieldName;
  const primaryKey = getDirectiveValue(directive, "primaryKey") || "id";
  const foreignKey =
    getDirectiveValue(directive, "foreignKey") || `${fieldName}_id`;
  const resource = getDirectiveValue(directive, "auth");
  const ownerKey = getDirectiveValue(directive, "ownerKey");
  const auth = authorize({ account_id: 1, resource, ownerKey });
  field.resolve = (obj, args, context, info) => {
    const loader = (function getLoader() {
      if (!context["_loader"]) context["_loader"] = new Map();
      if (context["_loader"].has(table))
        return context["_loader"].get(table) as Loader;
      const loader: Loader = new Loader(knex, async keys =>
        loader
          .select(table, auth, q => q.whereIn(primaryKey, keys))
          .then(rows =>
            keys.map(key => rows.find(row => row[primaryKey] == key) || null)
          )
      );
      context["_loader"].set(table, loader);
      return loader;
    })();
    if (field.type instanceof graphql.GraphQLList) {
      if (directive.name.value == "hasMany") {
        return loader
          .batch(obj[primaryKey], keys =>
            loader.select(table, auth, q => q.whereIn(foreignKey, keys))
          )
          .then(rows =>
            rows.filter((row: any) => row[foreignKey] == obj[primaryKey])
          );
      }
      return loader.select(table, auth, q =>
        q.limit(args.limit || 1000).offset(args.offset || 0)
      );
    } else {
      if (directive.name.value == "belongsTo") {
        return obj[foreignKey] && loader.dataloader.load(obj[foreignKey]);
      }
    }
  };
}

function getDirectiveValue(
  directive: graphql.DirectiveNode,
  name: string
): string | undefined {
  return directive.arguments
    ?.filter(e => e.name.value === name)
    ?.map(e => (e.value.kind === "StringValue" ? e.value.value : undefined))
    .pop();
}

const knex = Knex({
  client: "mysql2",
  connection: {
    user: "root",
    database: "hello"
  }
});

(async function() {
  const schema = buildSchema();
  const app = express();
  const server = new ApolloServer({ schema });
  server.applyMiddleware({ app, path: "/graphql" });
  app.listen(4000);
})();

import * as graphql from "graphql";
import { buildSchemaFromTypeDefinitions } from "graphql-tools";
import { importSchema } from "graphql-import";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import Knex from "knex";
import Dataloader from "dataloader";
import { authorize } from "./auth";

const knex = Knex({
  client: "mysql2",
  connection: {
    user: "root",
    database: "hello"
  }
});

async function select<Row>(
  table: string,
  ...fn: (((q: Knex.QueryBuilder) => Knex.QueryBuilder) | undefined)[]
): Promise<Row[]> {
  let select = knex.select().from(table);
  fn.forEach(fn => (select = fn ? fn(select) : select));
  console.debug(select.toString());
  return select;
}

class BatchLoader<Key, Row> {
  private keys: Key[] = [];
  private rows: Row[] = [];
  private callbacks: ((rows: Row[]) => void)[] = [];
  load(key: Key, load: (keys: Key[]) => Promise<Row[]>): Promise<Row[]> {
    let a: undefined;
    this.keys.push(key);
    return new Promise(resolve => {
      this.callbacks.push(resolve);
      setTimeout(async () => {
        if (this.keys.length == 0) return;
        const keys = this.keys.slice();
        const callbacks = this.callbacks.slice();
        this.keys.length = 0;
        (await load(keys)).forEach(e => this.rows.push(e));
        callbacks.forEach(e => e(this.rows));
      });
    });
  }
}

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
        return context["_loader"].get(table) as typeof loader;
      const loader = {
        dataloader: new Dataloader(async keys =>
          sortForDataloader(
            primaryKey,
            keys,
            await select(table, auth, q => q.whereIn(primaryKey, keys))
          )
        ),
        batchLoader: new BatchLoader()
      };
      context["_loader"].set(table, loader);
      return loader;
    })();
    if (field.type instanceof graphql.GraphQLList) {
      if (directive.name.value == "hasMany") {
        return loader.batchLoader
          .load(obj[primaryKey], keys =>
            select(table, auth, q => q.whereIn(foreignKey, keys))
          )
          .then(rows =>
            rows.filter((row: any) => row[foreignKey] == obj[primaryKey])
          );
      }
      return select(table, auth, q =>
        q.limit(args.limit || 1000).offset(args.offset || 0)
      );
    } else {
      if (directive.name.value == "belongsTo") {
        return obj[foreignKey] && loader.dataloader.load(obj[foreignKey]);
      }
    }
  };
}

function sortForDataloader<Key, Row>(
  primaryKey: string,
  keys: readonly Key[],
  rows: readonly Row[]
): (Row | undefined)[] {
  return keys.map(key => rows.find((row: any) => row[primaryKey] == key));
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

(async function() {
  const schema = buildSchema();
  const app = express();
  const server = new ApolloServer({ schema });
  server.applyMiddleware({ app, path: "/graphql" });
  app.listen(4000);
})();

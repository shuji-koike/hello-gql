import * as graphql from "graphql";
import { authorize } from "../auth";
import { Loader } from "./loader";

export function buildResolver(
  field: graphql.GraphQLField<any, any>,
  directive: graphql.DirectiveNode
) {
  if (field.resolve) return;
  const table = getDirectiveValue(directive, "table") || field.name;
  const primaryKey = getDirectiveValue(directive, "primaryKey") || "id";
  const foreignKey =
    getDirectiveValue(directive, "foreignKey") || `${field.name}_id`;
  const resource = getDirectiveValue(directive, "auth");
  const ownerKey = getDirectiveValue(directive, "ownerKey");
  field.resolve = (obj, args, context, info) => {
    const auth = authorize({ account_id: 1, resource, ownerKey });
    const loader = (function getLoader() {
      if (!context["_loader"]) context["_loader"] = new Map();
      if (context["_loader"].has(table))
        return context["_loader"].get(table) as Loader;
      const loader: Loader = new Loader(context.knex, async keys =>
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

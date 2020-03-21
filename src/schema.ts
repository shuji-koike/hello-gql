import { schemaDirectives } from "./directive";
import { importSchema } from "graphql-import";
import { makeExecutableSchema } from "graphql-tools";

export const schema = makeExecutableSchema({
  typeDefs: importSchema("./schema.graphql", {}),
  schemaDirectives
});

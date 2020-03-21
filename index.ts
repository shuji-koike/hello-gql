import express from "express";
import { ApolloServer } from "apollo-server-express";
import Knex from "knex";
import { buildSchema } from "./resolver";

(async function() {
  const knex = Knex("mysql2://root@localhost/hello");
  const schema = buildSchema(knex);
  const app = express();
  const server = new ApolloServer({ schema });
  server.applyMiddleware({ app, path: "/graphql" });
  app.listen(4000);
})();

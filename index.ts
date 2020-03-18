import express from "express";
import { makeExecutableSchema } from "graphql-tools";
import { ApolloServer } from "apollo-server-express";
import mysql, { RowDataPacket } from "mysql2/promise";
import { importSchema } from "graphql-import";

var connection = mysql.createPool({
  user: "root",
  database: "cirqua_csl"
});

(async function() {
  const [rows] = await connection.query("SELECT 1");
  console.log(rows);
})();

const server = new ApolloServer({
  schema: makeExecutableSchema({
    typeDefs: importSchema("./schema.graphql", {}),
    resolvers: {
      Query: {
        rev() {
          return "test";
        },
        async campaigns(a, args) {
          console.log(a, args);
          try {
            const [rows] = await connection.query<RowDataPacket[]>(
              "SELECT * FROM `campaigns`"
            );
            console.log(rows.map(e => e));
            return rows;
          } catch {}
        }
      }
    }
  })
});

const app = express();
server.applyMiddleware({ app, path: "/graphql" });
app.listen(4000, () => console.log("listen: 4000"));

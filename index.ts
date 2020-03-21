import Knex from "knex";
import { schema } from "./src/schema";
import { Server } from "./src/server";

(async function() {
  const knex = Knex("mysql2://root@localhost/hello");
  await knex.select(1);
  await Server.start({
    schema,
    context: { knex }
  });
})();

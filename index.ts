import Knex from "knex";
import { buildSchema } from "./resolver";
import { Server } from "./src/server";

(async function() {
  const knex = Knex("mysql2://root@localhost/hello");
  await knex.select(1);
  await Server.start({
    schema: buildSchema(),
    context: { knex }
  });
})();

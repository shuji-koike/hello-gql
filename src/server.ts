import express from "express";
import { ApolloServer, Config } from "apollo-server-express";

interface ServerConfig extends Config {
  port?: number;
  path?: string;
}

export class Server {
  static async start(config: ServerConfig) {
    Object.assign(config, { port: 4000, path: "/graphql" }, config);
    const app = express();
    app.use(new ApolloServer(config).getMiddleware({ path: config.path }));
    app.listen(config.port, () =>
      console.log(`Server.start: port: ${config.port}`)
    );
  }
}

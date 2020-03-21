import * as graphql from "graphql";
import { SchemaDirectiveVisitor } from "graphql-tools";
import { buildResolver } from "./resolver";

export class TableDirective extends SchemaDirectiveVisitor {
  public visitFieldDefinition(field: graphql.GraphQLField<any, any>) {
    buildResolver(
      field,
      field.astNode?.directives?.find(e => e.name.value == this.name)!
    );
  }
}

export class HiddenDirective extends SchemaDirectiveVisitor {
  public visitFieldDefinition(field: graphql.GraphQLField<any, any>) {
    field.resolve = () => {
      throw new Error("Forbidden accesss on @hidden field");
    };
  }
}

export const schemaDirectives = {
  hidden: HiddenDirective,
  table: TableDirective,
  belongsTo: TableDirective,
  hasMany: TableDirective
};

import Knex from "knex";

interface AuthorizeOption {
  account_id: number;
  resource?: string;
  ownerKey?: string;
}

export function authorize({ account_id, resource, ownerKey }: AuthorizeOption) {
  if (resource && ownerKey) {
    return (q: Knex.QueryBuilder) =>
      q.whereIn(ownerKey, (q: Knex.QueryBuilder) =>
        q
          .select(ownerKey)
          .from("auth")
          .where({
            account_id,
            resource
          })
          .whereIn("action", ["view", "edit"])
      );
  }
  if (resource)
    return (q: Knex.QueryBuilder) =>
      q.whereExists((q: Knex.QueryBuilder) =>
        q
          .select()
          .from("auth")
          .where({
            account_id,
            resource
          })
          .whereIn("action", ["view", "edit"])
      );
}

import Knex from "knex";

interface AuthorizeOption {
  account_id: number;
  resource?: string;
  ownerKey?: string;
}

export function authorize(option: AuthorizeOption) {
  if (option.resource && option.ownerKey) return authorizeOwner(option);
  if (option.resource) return authorizeResource(option);
}

function authorizeOwner({ account_id, resource, ownerKey }: AuthorizeOption) {
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

function authorizeResource({ account_id, resource }: AuthorizeOption) {
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

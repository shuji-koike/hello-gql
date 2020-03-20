import Knex from "knex";

interface AuthorizeOption {
  account_id: number;
  resource?: string;
}

export function authorize(option: AuthorizeOption) {
  if (!option.resource) return;
  return authorizeOwner(option);
}

export function authorizeOwner({ account_id, resource }: AuthorizeOption) {
  return (q: Knex.QueryBuilder) =>
    q.whereIn("owner_id", (q: Knex.QueryBuilder) =>
      q
        .select("owner_id")
        .from("auth")
        .where({
          account_id,
          resource
        })
        .whereIn("action", ["view", "edit"])
    );
}

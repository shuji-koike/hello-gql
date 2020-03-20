CREATE OR REPLACE ALGORITHM = MERGE VIEW accounts AS SELECT * FROM cirqua_csl.accounts;
CREATE OR REPLACE ALGORITHM = MERGE VIEW campaigns AS SELECT * FROM cirqua_csl.campaigns;
CREATE OR REPLACE ALGORITHM = MERGE VIEW roles AS SELECT * FROM cirqua_csl.roles;
CREATE OR REPLACE ALGORITHM = MERGE VIEW role_authorities AS SELECT * FROM cirqua_csl.role_authorities;
CREATE OR REPLACE ALGORITHM = MERGE VIEW campaigns_categories AS SELECT * FROM cirqua_csl.campaigns_categories;
CREATE OR REPLACE ALGORITHM = MERGE VIEW categories AS SELECT * FROM cirqua_csl.categories;
CREATE OR REPLACE ALGORITHM = MERGE VIEW auth AS
SELECT
  accounts.id AS account_id,
  owners.id AS owner_id,
  accounts.account_type,
  accounts.role_id,
  role_authorities.resource,
  role_authorities.action
FROM accounts
JOIN roles ON roles.id = accounts.role_id
JOIN role_authorities ON role_authorities.role_id = roles.id
JOIN (
  SELECT id, id_as_organization, id_as_group FROM accounts) AS owners ON (
    CASE
      WHEN accounts.account_type = 'all' THEN 1 = 1
      WHEN accounts.account_type = 'organization' THEN accounts.id = owners.id OR accounts.id = owners.id_as_organization
      WHEN accounts.account_type = 'account_group' THEN accounts.id = owners.id OR accounts.id = owners.id_as_group
      ELSE accounts.id = owners.id
      END
)
ORDER BY accounts.id, owners.id
;
/*
SELECT * FROM campaigns
WHERE owner_id IN (
  SELECT owner_id FROM auth
  WHERE account_id = 6
  AND resource = 'campaigns'
  AND action IN ('view', 'edit')
);
SELECT FOUND_ROWS();
*/

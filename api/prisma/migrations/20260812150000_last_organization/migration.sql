-- Which workspace to open on the next sign-in.
--
-- `login` used to take the oldest active membership. That is stable, and it
-- is wrong for anybody who belongs to two: a contractor with their own
-- workspace who accepts an invitation into an agency's would be returned to
-- their own on every subsequent sign-in, with nothing on screen to suggest
-- the other one existed. The membership row was correct the whole time; the
-- session was pointed at the wrong organisation.
--
-- Nullable, and no foreign key. This is a hint rather than a fact: if the
-- membership it names is revoked, `login` falls back to the oldest one. A
-- foreign key would instead make removing somebody from an organisation
-- depend on nobody having it as their last-used, which is a constraint with
-- no meaning behind it.

ALTER TABLE "User" ADD COLUMN "lastOrgId" UUID;

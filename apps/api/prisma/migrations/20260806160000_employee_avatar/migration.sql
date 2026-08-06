-- The storage key behind Employee.avatarUrl.
--
-- `avatarUrl` already existed and has never been written to; it now holds the
-- path that serves the photo. This column holds the opaque key the storage
-- adapter needs, because replacing or removing a photo has to delete the
-- previous object and a served path cannot be turned back into a key.
ALTER TABLE "Employee" ADD COLUMN "avatarKey" TEXT;

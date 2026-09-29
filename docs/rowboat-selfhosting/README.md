# Rowboat Harbor self-hosting patch

This directory holds a patch for **Leon4gr45/rowboat**, not TrueForge. It is kept on this deployment branch so it can be reviewed and applied to the Rowboat Hugging Face Space repository separately. It does not change TrueForge's runtime.

## What it changes

- Configures Harbor's public address as `leon4gr45-rowboat.hf.space`, fixing the landing page's `rowboat://open` link that currently targets `localhost:7860`.
- Adds `HARBOR_MODE=single`, with one owner and a private `HARBOR_LOCAL_TOKEN`, rather than Rowboat cloud sign-in or predictable `dev-<memberId>` development tokens.
- Uses PGlite at `/data/pglite` and blobs at `/data/blobs` by default in the Rowboat Space Dockerfile. `DATABASE_URL` can select Postgres instead.

## Apply to Rowboat

1. In **Leon4gr45/rowboat** Space Settings, attach a private read-write Storage Bucket at `/data`. Set `HARBOR_LOCAL_TOKEN` as a Space **secret** to a random value of at least 32 characters. Generate one locally with `openssl rand -hex 32`. Keep it out of GitHub and chat. For reliable database durability, prefer a Postgres `DATABASE_URL`; PGlite on the bucket mount has not been verified.
2. Apply [rowboat-selfhost.patch](./rowboat-selfhost.patch) to a clone of the **Rowboat Space repository** at the commit it was made against (`1da80cbc2be4e0ac224a8c087db693d822311407`):

   ```sh
   git clone https://huggingface.co/spaces/Leon4gr45/rowboat
   cd rowboat
   git am /path/to/rowboat-selfhost.patch
   git push origin main
   ```

3. Install the Rowboat desktop app. In **Spaces → Add a dev server**, enter `https://leon4gr45-rowboat.hf.space` and paste the raw access key into **Member id**. The desktop app adds the `dev-` prefix on the wire. Once saved, the landing page's **Open in Rowboat** button routes to that server.

The web root remains a desktop deep-link handoff, not a browser version of Rowboat. A missing secret prevents the patched server from starting. Without a persistent mount, Space files disappear on restart. Anyone who knows the access key can act as the owner; rotate it if it leaks.

## Verification before upload

The patch was typechecked and built locally; 17 focused Harbor tests passed, including rejection of unauthenticated and predictable tokens and verification of the public deep-link address. Live behavior on Hugging Face remains unverified until the Space is updated.

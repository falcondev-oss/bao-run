# bao-run

Runs a command with secrets from [OpenBao](https://openbao.org), like `infisical run`. It logs in with an AppRole, reads one KV v2 secret, puts its keys into the environment and starts the command. No dependencies, only Node 20 or newer.

```sh
bao-run -- node server/index.mjs
```

## Environment

| Variable          | Description                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| `BAO_ADDR`        | OpenBao address, e.g. `https://bao.example.com:8200`                            |
| `BAO_ROLE_ID`     | Role ID of the AppRole                                                          |
| `BAO_SECRET_ID`   | Secret ID of the AppRole                                                        |
| `BAO_SECRET_PATH` | Path of the secret in the KV v2 engine mounted at `secret/`, e.g. `my-app/prod` |

The keys of the secret override variables of the same name. The command does not see `BAO_ROLE_ID` and `BAO_SECRET_ID`. Every value of the secret must be a string.

`bao-run` forwards `SIGTERM`, `SIGINT` and `SIGHUP` to the command and exits with its exit code. It exits with `1` if OpenBao rejects the login or the read or a value is not a string, and with `127` if the command does not exist.

## Docker

Set the address in the image and the AppRole in the deployment:

```dockerfile
FROM node:24-alpine
RUN npm install -g @falcondev-oss/bao-run@0
ENV BAO_ADDR=https://bao.example.com:8200
# ...
CMD ["bao-run", "--", "./start.sh"]
```

```yaml
services:
  app:
    environment:
      BAO_ROLE_ID: ${BAO_ROLE_ID:?}
      BAO_SECRET_ID: ${BAO_SECRET_ID:?}
      BAO_SECRET_PATH: my-app/prod
```

The AppRole needs a policy that can read the secret:

```hcl
path "secret/data/my-app/prod" { capabilities = ["read"] }
```

# Platform database setup and validation

The application uses the dedicated `SmartBoardAI` MongoDB database. Private lecture data is prohibited; see [storage policy](../contracts/storage-policy.md).

## Credentials and startup

The user has already created the database and configured its SRV connection in ignored `.env` as `MONGO_DEV`. Keep that file private and untouched by Git. Development accepts `MONGO_DEV`; the preferred key is `MONGODB_URI`, which takes precedence and is required in production. The URI database must be `SmartBoardAI` or omitted; the code explicitly selects that database. Do not reuse another project's database.

All npm start variants and `db:check` load `.env` if it exists. Existing process environment variables win. Tests do not load it. The app fails startup with a safe fixed error when configuration is missing or the initial connection fails; it does not start an unauthenticated replacement service or create a fallback database. The connection factory sanitizes failures before Nest can log them and closes failed connections.

In Atlas, grant the application only the intended platform-database permissions and allow the development host's actual network address. Do not broadly expose MongoDB. No Docker database is required for this supplied connection. No credentials, hosts or raw driver errors are printed by the diagnostic.

## Read-only diagnostic

```bash
npm run db:check
```

The command opens one bounded Mongoose connection, checks ping/topology, lists collection metadata, counts up to one document in each unexpected collection without returning its contents, and closes its connection. It does not create/delete collections or mutate any records. No HTTP server starts. It prints:

- `database`: selected application/test database name.
- `platformDatabase`: `up` or `down`.
- `transactions`: `supported`, `unsupported` or `unknown`, based on topology/session/wire-version capabilities.
- `collectionCount`, `unexpectedCollectionCount`, `unexpectedNonemptyCollectionCount`: numeric policy observations, without collection names or content.

Exit 0 means all these checks pass and collection names fit the policy. Exit 1 means a connection/probe failure, unsupported topology or unexpected collection. Ping/hello do not prove create/update/index/transaction permissions. Those require future tests against an isolated disposable database. An allowed collection name alone does not prove its schema/content is safe.

On 2026-10-25, live read-only verification reached `SmartBoardAI`, found transaction-capable topology and one unexpected **empty** collection. The command correctly exited 1 for that policy finding. No documents were returned; no collections were changed or removed. Leave the pre-existing collection intact unless the user explicitly authorizes a specific cleanup. Identity development can continue with explicit allowed schemas, but the clean policy check remains unresolved.

## Application connection behavior

Automatic collection/index creation, Mongoose debug output, command monitoring and command buffering are disabled. Connection/server-selection/socket timeouts are 5 seconds, maximum pool size 10. Readiness probes use 2-second command timeouts. The app closes its own connection on shutdown. Initial connection failure is terminal; after an established connection loses connectivity, the driver can reconnect and readiness reports failure until checks recover. No records or indexes are created in this increment.

The project uses the standard Nest Mongoose connection injection token with a custom connection factory to sanitize initial failures before retry logging. Future feature modules can use `MongooseModule.forFeature` and explicit schemas/collections. See [Nest MongoDB integration](https://docs.nestjs.com/techniques/mongodb) and [Mongoose connection options](https://mongoosejs.com/docs/connections.html).

## Disposable integration databases

Future write-based integration suites must use `NODE_ENV=test`, `MONGODB_TEST_URI`, and an exact `MONGODB_TEST_DATABASE` matching `smartbord_test_<32 lowercase hex digits>`. Missing/unsafe settings or a mismatched URI are rejected; application credentials are never used as a fallback. Unit/HTTP suites use synthetic connections and do not require a real database.

Generate a unique test name per run and provision appropriately scoped test credentials. Before cleanup, check both the exact generated name and the connected database name immediately before dropping that test database. Refuse production execution. Close all test connections/apps. No automatic drop/cleanup command exists in this increment, and no application database has been used as a fixture.

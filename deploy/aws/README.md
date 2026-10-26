# Elemnt on AWS

One CloudFormation stack, `elemnt.yaml`:

- **App Runner** runs the server image from ECR, one instance, health-checked on `/healthz`.
- **RDS Postgres 17** in private subnets, encrypted, with 7 days of backups, deletion protection and a snapshot on delete.
- **S3** for page sources and rendered HTML: private, encrypted, versioned, kept if the stack is deleted. The app reaches it through a VPC endpoint with its instance role; there are no access keys.
- **Secrets Manager** holds the generated database password and `ELEMNT_SECRET_KEY`.
- A VPC with one NAT gateway, so the app can reach RDS privately and still call Anthropic, GitHub and LinkedIn.

> The template passes `cfn-lint`, but it hasn't been deployed end to end yet. Tell us what breaks.

The fixed monthly costs are the App Runner instance, the RDS instance and the NAT gateway; check current AWS pricing for your region. S3 is pennies.

## Deploy

1. **Push the image.** From the repo root:
   ```sh
   aws ecr create-repository --repository-name elemnt
   REPO=$(aws ecr describe-repositories --repository-names elemnt --query 'repositories[0].repositoryUri' --output text)
   aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
   docker build --platform linux/amd64 -f apps/server/Dockerfile -t "$REPO:latest" .
   docker push "$REPO:latest"
   ```
2. **Create the stack.**
   ```sh
   aws cloudformation deploy --stack-name elemnt --template-file deploy/aws/elemnt.yaml \
     --capabilities CAPABILITY_IAM \
     --parameter-overrides ImageUri="$REPO:latest" PublicUrl=https://docs.example.com \
       SandboxUrl=https://example-usercontent.net OwnerEmail=you@example.com
   ```
   This takes 15 to 20 minutes, mostly RDS.
3. **Sign in.** Open the App Runner service's application logs (CloudWatch, `/aws/apprunner/elemnt/…/application`). The first start creates the workspace for `OwnerEmail` and prints that owner's API token once. Sign in at `<ServiceUrl>/login` from the stack outputs, make a fresh token in Settings, and revoke the bootstrap one.
4. **Your domains.** Link both hostnames to the service and add the DNS records it prints:
   ```sh
   ARN=$(aws cloudformation describe-stacks --stack-name elemnt --query "Stacks[0].Outputs[?OutputKey=='ServiceArn'].OutputValue" --output text)
   aws apprunner associate-custom-domain --service-arn "$ARN" --domain-name docs.example.com --no-enable-www-subdomain
   aws apprunner associate-custom-domain --service-arn "$ARN" --domain-name example-usercontent.net --no-enable-www-subdomain
   ```
   The sandbox hostname must be on a **different registrable domain** from the main one, or widgets would share the app's site. Leave `SandboxUrl` empty to turn widgets and runnable code off.

New pushes to the same tag deploy automatically. Anthropic keys are set per workspace in Settings, so the stack has none.

## Optional integrations

GitHub and LinkedIn settings (see `.env.example` in the repo root) are plain variables on the App Runner service. Add them in the console under Configuration → Environment variables, or as Secrets Manager references for the secret ones, then deploy.

## Notes

- One instance on purpose: the server keeps rate limits and render caches in memory.
- The connection string carries no password. The server's Postgres driver reads it from `PGPASSWORD`, which App Runner fills in from Secrets Manager.
- `ELEMNT_SECRET_KEY` is 43 random letters and digits, which decode as exactly 32 bytes of base64. Don't rotate the secret: stored API keys and LinkedIn tokens are encrypted with it.
- RDS has deletion protection. To tear down, turn it off on the instance first; the bucket and a final snapshot are kept.

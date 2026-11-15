# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- The Woodpecker personal access token, stored by Gladys in the integration
  configuration (a `secret` field). It is sent only to the configured
  Woodpecker address, in the `Authorization` header, never written to the logs
  or to `/data`. Redirects are not followed, so the token never leaves for
  another address. It carries the rights of its user: a dedicated user limits
  what a leak would expose.
- `/data/woodpecker-state.json`: the Woodpecker address, and, per followed
  repository, the numbers of the pipelines already seen and whether it was
  failing, plus the scene events Gladys refused. No token, no pipeline content.
- Network: HTTP(S) requests to the Woodpecker server only; nothing is listened
  to. Restarting a pipeline (a POST) is off unless the user turns it on.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.

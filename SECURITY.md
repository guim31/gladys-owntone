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

The integration connects to one OwnTone server on the local network: its JSON API over plain HTTP
(port 3689 by default) and its notification WebSocket (port 3688 by default), without TLS, as OwnTone
serves them. The optional admin password is kept by Gladys in the integration configuration, sent to
OwnTone as HTTP Basic authentication and never written to the logs. The integration stores nothing
under `/data`, opens no port and exposes no service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), and OwnTone and the
speakers the integration talks to.

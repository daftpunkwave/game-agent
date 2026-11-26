# Security Policy

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, pull requests, or discussions.

Instead, report vulnerabilities privately through GitHub Security Advisories (**Security -> Advisories -> Report a vulnerability**) on this repository. Include:

- Affected component, commit SHA, or version
- Clear reproduction steps or proof of concept
- Expected security boundary vs. observed behavior
- Potential impact (e.g., credential leakage, prompt injection bypass, unauthorized game command execution)

Maintainers will acknowledge receipt promptly, assess severity, and coordinate a fix before public disclosure.

## Security Boundaries & Non-Negotiables

Contributors and AI Coding Agents must uphold these boundaries at all times:

1. **No Committed Secrets**: Never commit API keys, tokens, credentials, or `.env` files containing real secrets.
2. **Untrusted Game Text Isolation**: All external player chat, whispers, mail, and game-world strings must enter through structured untrusted data slots and pass injection/authority guards—never interpolate untrusted text into system instructions.
3. **Single-Port Egress Guardrails**: Game commands must pass server/gateway schema validation, idempotency checks, and quota limits before hitting any transport adapter.
4. **Visibility Cropping**: Neither the model nor the behavior tree may receive hidden internal game fields that a normal player client cannot observe; cropping happens in the ingress gateway before data reaches either.

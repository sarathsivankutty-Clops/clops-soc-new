# Groq BYOK and UI Findings

## Summary

The codebase does not provide a named Groq provider. It does provide a generic
`Custom endpoint` BYOK option that appears compatible with an OpenAI-style
chat-completions service. The Settings page now exposes the existing BYOK form
through the visible **AI Settings** tab.

## Confirmed from the repository

- The Settings page renders `SettingsTabs`. **AI Settings** is visible after
  General and before Connectors. See
  [`SettingsTabs.tsx`](../apps/web/src/components/settings/SettingsTabs.tsx).
- The Deployment & AI panel, including the BYOK card, remains implemented in
  [`SettingsView.tsx`](../apps/web/src/components/settings/SettingsView.tsx).
  The new tab reuses that panel. The existing
  `/settings?section=deployment` deep link opens the AI Settings tab.
- In the BYOK form, `Custom endpoint` requires a base URL. The UI does not
  require a key for that provider, but a provider such as Groq may require one
  operationally. The form supports a model ID, an endpoint model-discovery
  action, and a saved-credential Test action.
- The backend accepts arbitrary HTTP(S) base URLs for the `custom` provider and
  sends chat-completions requests to the configured endpoint. The repository
  contains no explicit Groq provider entry or Groq-specific configuration.
  Relevant implementation: [`llm_credentials.py`](../services/api/app/api/v1/endpoints/llm_credentials.py),
  [`llm_credential_probe.py`](../services/api/app/services/llm_credential_probe.py),
  and [`llm_model_discovery.py`](../services/api/app/services/llm_model_discovery.py).

## Practical conclusion

If using a Groq endpoint that is compatible with the request format this app
uses, configure it as **Custom endpoint**, not OpenAI. The previous suggested
base URL was `https://api.groq.com/openai/v1`; the repository itself does not
document or verify that provider URL. Supply a model ID supported by the
account, save the credential, then use **Test** to check the actual connection.

Open **Settings → AI Settings** in the UI, or use the existing deep link:

```text
/settings?section=deployment
```

If the tab or deep link is absent in the running deployment, it may be running
an earlier version than the checked-in source.

## Scope

This note records repository findings and the Settings entry point. The NAV-7
change only updates UI navigation; API, auth, and data behavior are unchanged.

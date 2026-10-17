# PhilForms MCP server

Lets Claude, Cursor or any MCP client find, fill and verify official Philippine government forms — BIR, SSS,
PhilHealth, Pag-IBIG, CSC, GSIS, COA, GPPB — through the [PhilForms](https://philforms.com) API. Every input on
1,342 forms is mapped to its printed box, so a TIN lands digit by digit in its cells, and values the form cannot
hold are refused with the reason instead of being "fixed".

Not affiliated with BIR, SSS, PhilHealth, Pag-IBIG or any government agency. PhilForms fills and prints; you file.

## Tools

| Tool | What it does |
|---|---|
| `search_forms` | Search the catalogue ("2307", "philhealth claim") → form ids |
| `get_form_parameters` | One form's fill contract: every parameter, label, type, format, choices |
| `check_form_values` | Check values before filling, each as it would print |
| `fill_form` | Fill a form → saved PDF path + tamper-evident document id |
| `verify_pdf` | Check that a filled PDF is unaltered |

## Set up

Get an API key at [philforms.com/account](https://philforms.com/account) (`pk_test_…` is free and watermarked).

```json
{
  "mcpServers": {
    "philforms": {
      "command": "npx",
      "args": ["-y", "philforms-mcp"],
      "env": { "PDFPHILE_API_KEY": "pk_test_…" }
    }
  }
}
```

Filled PDFs go to `PDFPHILE_OUT_DIR` (default `./pdfphile-out`). Requires Node 18+. No dependencies.

API reference: [philforms.com/developers](https://philforms.com/developers) · OpenAPI: `https://philforms.com/api/v1/openapi.json`

## License

MIT — this repository holds only the MCP client. The PhilForms service itself is not open source.

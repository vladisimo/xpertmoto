# Grafana dashboards — payments

This folder holds the committed Grafana dashboard JSON used by the
`XPERT Moto — Payments Overview` dashboard. Panels source from the
`/api/metrics` Prometheus scrape endpoint (see [G14](../risk-register.md)).

## Import

1. Grafana → Dashboards → New → Import.
2. Upload `payments-overview.json` (or paste its contents).
3. When prompted, select your Prometheus datasource.
4. Save.

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: xpertmoto
    metrics_path: /api/metrics
    scheme: https
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/xpertmoto-metrics-token
    static_configs:
      - targets: ['xpertmoto.com.au']
```

Generate the token and store it in `SystemSetting`:

```bash
# Write token via the integration-config helper (requires admin shell access)
node -e "require('./src/lib/integration-config').setSecret('metrics:scrapeToken', process.env.NEW_TOKEN)"
```

## Alerts

Suggested alerts (configure in Grafana Alerting):

| Alert | Expression | Severity |
|-------|-----------|----------|
| Unmatched transactions growing | `sum(unmatched_transactions_total) > 0 for 30m` | warning |
| Stripe webhook success < 99% for 15m | `sum(rate(stripe_webhook_total{outcome="processed"}[5m])) / sum(rate(stripe_webhook_total[5m])) < 0.99` | critical |
| Payment retry exhaustion rate | `increase(payment_status_transition_total{to="FAILED"}[10m]) > 5` | critical |
| Stripe API p99 latency | `histogram_quantile(0.99, ...) > 5` | warning |

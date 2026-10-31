# Pulso

[Português](README.md)

A daily AI news journal in Brazilian Portuguese, assembled by a program and published with no human review in between. Live at **[pulso.dorly.com.br](https://pulso.dorly.com.br/)**.

<img src="docs/img/como-funciona.png" alt="The six steps of an edition (read, select, open each link, write, check, publish) with the numbers from edition #106: 27 feeds, up to 50 items, 44 published for US$ 0.47.">

Every morning at 07:30 (São Paulo) the pipeline reads 27 feeds from AI labs and from the press in the US, Europe, Asia and Brazil. It picks up to 50 items with a quota per region and per outlet, so the front page is not decided by whoever publishes the most. It opens every link and writes the title, a one-line blurb and a summary in Portuguese from the article body, not from the headline.

Then the text is checked twice, with no editor involved:

- a deterministic gate matches every amount, percentage, precise number and model version against the source page and drops the field that doesn't hold up;
- a second model, different from the one that wrote the text, looks for the rest (misattribution, "plans to launch" turned into "launched", overstatement) and drops only the field it can quote as unsupported.

Prose, framing and editorial judgement are **not** checked. When nothing survives and the last front page is older than 36 hours, the journal publishes a quiet edition that says what was checked and why nothing got in.

It runs entirely on GitHub Actions, GitHub Pages, a Cloudflare R2 bucket and a Cloudflare Worker that triggers the runs. The only paid part is the OpenAI API: about US$ 0.50 an edition, with a hard cap of US$ 4 per run.

The full documentation is in Portuguese: [README](README.md), [how it works](docs/como-funciona.md), [operations](docs/operacao.md) and [measurements](research/). Code under the [Apache License 2.0](LICENSE); the Pulso and Professor Dorly names, logos and visual identity are not covered by it ([TRADEMARKS.md](TRADEMARKS.md)).

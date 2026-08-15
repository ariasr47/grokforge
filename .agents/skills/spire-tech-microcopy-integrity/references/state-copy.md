# State copy

| State | Copy must |
| --- | --- |
| empty | Explain zero results and a next action when one exists |
| loading | Not imply success or completion |
| error | Admit failure and recovery when available; never look like success |
| offline | Admit connectivity when that is the cause |
| stale | Disclose age/refresh if the product cares about freshness |

If two states share identical copy, they are not distinct enough for users — split wording or merge states.

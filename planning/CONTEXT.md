# RefCycle whole app

RefCycle began as a student concept by a five-person team in the Berkeley UX/UI Boot Camp, UC Berkeley Extension, January 2024. This rebuild and evaluation are solo work.

## Language

**Portfolio demo**:
The public, try-it-yourself RefCycle app. Runs publicly; makes no promise that its rules stay current.
_Avoid_: production app, live service

**Place**:
One of the three supported areas whose rules pack the engine reads: Seattle, Austin, Hawaiʻi County.
_Avoid_: city, region, location (when meaning the supported area)

**Home**:
The first screen after choosing a Place. It routes to Recyclopedia, Camera scan and the locator, and holds no content of its own.
_Avoid_: dashboard, feed

**Place guidelines**:
A read-only view of one Place's rules pack, grouped by stream, every rule shown with its quote and source.
_Avoid_: local guidelines (when meaning hand-written text), collection schedule

**Reuse link**:
A link to an outside reuse or repair resource for a Place, shown on the "Give it another life" screen and below an item's answer. Never a rule, never part of the engine's answer.
_Avoid_: upcycling idea, recommendation

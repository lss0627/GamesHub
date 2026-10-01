# Contracts
GET /v1/game-capabilities返回公开能力目录。design消息/prepare/get携带类型与能力缺口；prepare可生成不可执行设计说明，confirm对缺口返回409 GAME_CAPABILITY_MISSING，保留草案，不入队。原API保持兼容。Unity输出只读window.__gamerhubGameState用于WebGL真实玩法验收，不提供后端权限。

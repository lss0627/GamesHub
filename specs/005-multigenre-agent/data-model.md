# Data model
DesignBrief保留旧8字段，增加可选genre、mechanics、requestedFeatures；旧值视为Runner。GameSpec使用现有genre/systems/rules扩展，custom用于未分类设计。能力目录描述runtime/template、系统、测试过滤器、玩法说明与缺口；Spec必须匹配对应执行模块，旧Runner合法。
Arena参数：生命、敌人速度/生命/刷新、攻击伤害/间隔/范围、经验阈值；Clicker：每次收益、自动收益、升级费用、目标。参数有界且经验证。快照仅提供游戏状态与Spec身份，不含路径或密钥。

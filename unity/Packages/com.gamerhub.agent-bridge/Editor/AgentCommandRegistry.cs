using System;
using System.Collections.Generic;

namespace GamerHub.AgentBridge
{
    public static class AgentCommandRegistry
    {
        private static readonly HashSet<string> Allowlist = new HashSet<string>(StringComparer.Ordinal)
        {
            "scene.create", "scene.edit", "game_object.create", "game_object.remove",
            "component.set_property", "prefab.create", "script.create", "asset.import",
            "compile", "test.editmode", "test.playmode", "play", "state.read", "build.web"
        };

        public static bool IsAllowed(string capability) => Allowlist.Contains(capability);

        public static void Demand(string capability)
        {
            if (!IsAllowed(capability))
                throw new InvalidOperationException($"COMMAND_NOT_ALLOWED: {capability}");
        }

        public static IReadOnlyCollection<string> List() => Allowlist;
    }
}

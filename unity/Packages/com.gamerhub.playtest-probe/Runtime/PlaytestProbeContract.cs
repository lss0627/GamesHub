using System;
using System.Collections.Generic;

namespace GamerHub.PlaytestProbe
{
    public static class PlaytestProbeContract
    {
        public const string ProtocolVersion = "1.0.0";
        private static readonly HashSet<string> Fields = new HashSet<string>(StringComparer.Ordinal)
        {
            "position", "velocity", "health", "score", "coins", "grounded", "animation", "collision"
        };

        public static bool IsAllowedField(string field) => Fields.Contains(field);
    }
}

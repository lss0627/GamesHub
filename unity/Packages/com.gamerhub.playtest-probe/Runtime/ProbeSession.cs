using System;

namespace GamerHub.PlaytestProbe
{
    public sealed class ProbeSession
    {
        public const string ProtocolVersion = "1.0.0";
        public string SessionId { get; } = Guid.NewGuid().ToString("N");
        public string ProjectRevision { get; private set; } = string.Empty;
        public string GameSpecVersion { get; private set; } = string.Empty;
        public bool Connected { get; private set; }

        public void Hello(string protocolVersion, string projectRevision, string gameSpecVersion)
        {
            if (protocolVersion != ProtocolVersion) throw new InvalidOperationException("PROTOCOL_MISMATCH");
            if (string.IsNullOrWhiteSpace(projectRevision) || string.IsNullOrWhiteSpace(gameSpecVersion)) throw new InvalidOperationException("SESSION_CONTEXT_REQUIRED");
            ProjectRevision = projectRevision;
            GameSpecVersion = gameSpecVersion;
            Connected = true;
        }

        public void Close() => Connected = false;
    }
}

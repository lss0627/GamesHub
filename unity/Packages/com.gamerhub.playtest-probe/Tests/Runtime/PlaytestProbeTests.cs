using NUnit.Framework;
using GamerHub.PlaytestProbe;

namespace GamerHub.PlaytestProbe.Tests
{
    public class PlaytestProbeTests
    {
        [Test]
        public void SessionOnlyAcceptsPinnedProtocolAndLogicalState()
        {
            Assert.That(PlaytestProbeContract.ProtocolVersion, Is.EqualTo("1.0.0"));
            Assert.That(PlaytestProbeContract.IsAllowedField("position"), Is.True);
            Assert.That(PlaytestProbeContract.IsAllowedField("reflection"), Is.False);
        }
    }
}

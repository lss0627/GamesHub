using NUnit.Framework;
using GamerHub.AgentBridge;

namespace GamerHub.AgentBridge.Tests
{
    public class AgentBridgeCommandTests
    {
        [Test]
        public void RegistryRejectsCommandsOutsideAllowlist()
        {
            Assert.That(AgentCommandRegistry.IsAllowed("unity.eval"), Is.False);
        }

        [Test]
        public void SceneObjectCommandUsesLogicalEntityId()
        {
            Assert.That(SceneObjectCommands.NormalizeLogicalId("Player"), Is.EqualTo("player"));
        }
    }
}

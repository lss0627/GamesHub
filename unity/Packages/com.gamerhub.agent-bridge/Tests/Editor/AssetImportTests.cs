using NUnit.Framework;
using GamerHub.AgentBridge;

namespace GamerHub.AgentBridge.Tests
{
    public class AssetImportTests
    {
        [Test]
        public void StableLogicalMappingUsesAllowlistedProfile()
        {
            Assert.That(AssetImportCommands.IsAllowedMime("image/png"), Is.True);
            Assert.That(AssetImportCommands.IsAllowedMime("application/x-shockwave-flash"), Is.False);
        }
    }
}

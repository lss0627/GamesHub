using GamerHub.Runner;
using NUnit.Framework;
using UnityEngine;

public sealed class CreativePlayModeTests
{
    [Test] public void AuthoredProjectMediaLoadsAndCreatesTheWholeHierarchy()
    {
        var resource=Resources.Load<TextAsset>("GamerHubCreative");if(resource==null)return;
        var document=JsonUtility.FromJson<CreativeDocument>(resource.text);Assert.AreEqual(1,document.version);
        var go=new GameObject("creative-import-test");
        try { var runtime=go.AddComponent<CreativeRuntime>();runtime.Load(document,resource.text);foreach(var node in document.nodes)Assert.AreEqual(node.id,runtime.Pose(node.id).id); }
        finally { Object.DestroyImmediate(go); }
    }
    [Test] public void KeyframesInterpolateAndSpriteFramesStep()
    {
        var track = new CreativeTrack { property="x", keys=new[] { new CreativeKey { time=0,value=100 },new CreativeKey { time=1,value=200 } } };
        Assert.AreEqual(150,CreativeRuntime.Sample(track,.5f));
        track.property="frame"; Assert.AreEqual(100,CreativeRuntime.Sample(track,.5f));
        Assert.AreEqual(200,CreativeRuntime.Sample(track,1));
    }
    [Test] public void PlaybackPausesAndRestartResets()
    {
        var go=new GameObject("creative-test");
        try {
            var runtime=go.AddComponent<CreativeRuntime>();
            runtime.Load(new CreativeDocument { nodes=new[] { new CreativeNode { id="banner",kind="rect",width=20,height=20,visible=true,opacity=1 } }, clips=new[] { new CreativeClip { id="move",duration=2,loop=true,trigger="start",tracks=new[] { new CreativeTrack {nodeId="banner",property="x",keys=new[] { new CreativeKey{time=0,value=0},new CreativeKey{time=2,value=100} } } } } } });
            runtime.Accept("{\"phase\":\"playing\"}");runtime.Advance(1);Assert.AreEqual(50,runtime.Pose("banner").x);
            runtime.Accept("{\"phase\":\"paused\"}");runtime.Advance(1);Assert.AreEqual(50,runtime.Pose("banner").x);
            runtime.Accept("{\"phase\":\"won\"}");runtime.Accept("{\"phase\":\"playing\"}");Assert.AreEqual(0,runtime.Pose("banner").x);
        } finally { Object.DestroyImmediate(go); }
    }
    [Test] public void SynthesizedAudioHasRealSamplesAndBoundedAmplitude()
    {
        var clip=CreativeRuntime.Tone(440,.1f);
        try { var samples=new float[clip.samples];Assert.IsTrue(clip.GetData(samples,0));float energy=0,peak=0;foreach(var x in samples){energy+=x*x;peak=Mathf.Max(peak,Mathf.Abs(x));}Assert.Greater(energy,1);Assert.LessOrEqual(peak,.25f); }
        finally { Object.DestroyImmediate(clip); }
    }
}

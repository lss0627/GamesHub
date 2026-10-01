using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;

namespace GamerHub.Runner
{
    [Serializable] public sealed class CreativeDocument { public int version=1; public CreativeNode[] nodes=Array.Empty<CreativeNode>(); public CreativeClip[] clips=Array.Empty<CreativeClip>(); public CreativeSound[] sounds=Array.Empty<CreativeSound>(); public float masterVolume=.7f; }
    [Serializable] public sealed class CreativeNode { public string id,name,kind,parentId="",phase="all",color="#ffffff",text="",assetId="",contentHash=""; public float x,y,width=100,height=100,rotation,opacity=1; public bool visible=true; public int columns=1,rows=1; }
    [Serializable] public sealed class CreativeKey { public float time,value; }
    [Serializable] public sealed class CreativeTrack { public string nodeId,property; public CreativeKey[] keys; }
    [Serializable] public sealed class CreativeClip { public string id,name,trigger; public float duration; public bool loop; public CreativeTrack[] tracks; }
    [Serializable] public sealed class CreativeSound { public string id,name,trigger,source,assetId,contentHash; public float volume,frequency,duration; public bool loop; }
    [Serializable] public sealed class CreativePose { public string id; public float x,y,width,height,rotation,opacity,frame; }
    [Serializable] public sealed class CreativeGameEvent { public string phase; public float total,score; public int health,kills; }
    [Serializable] public sealed class CreativeEvidence { public string phase,contentHash; public int nodes,clips,sounds,events,voices,activeClips; public float time; public bool muted; public CreativePose[] poses; }

    /// <summary>Versioned screen-space composition, shared by every curated 2D runtime.</summary>
    public sealed class CreativeRuntime : MonoBehaviour
    {
        public static CreativeRuntime Instance { get; private set; }
        private CreativeDocument document=new CreativeDocument();
        private readonly Dictionary<string,CreativeNode> nodes=new Dictionary<string,CreativeNode>();
        private readonly Dictionary<string,CreativePose> poses=new Dictionary<string,CreativePose>();
        private readonly Dictionary<string,Transform> objects=new Dictionary<string,Transform>();
        private readonly Dictionary<string,Texture2D> textures=new Dictionary<string,Texture2D>();
        private readonly Dictionary<string,float> started=new Dictionary<string,float>();
        private readonly Dictionary<string,AudioSource> sources=new Dictionary<string,AudioSource>();
        private readonly List<AudioClip> generated=new List<AudioClip>();
        private CreativeGameEvent previous=new CreativeGameEvent { phase="ready" };
        private float clock,reportAt;
        private int eventCount;
        private bool muted,focused=true;
        private string contentHash="";
        public string Phase => previous.phase;
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern void GamerHubCreativeState(string json);
#endif
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)] private static void Boot()
        {
            var resource=Resources.Load<TextAsset>("GamerHubCreative");
            if(resource==null || Instance!=null)return;
            var data=JsonUtility.FromJson<CreativeDocument>(resource.text);
            if(data==null || data.version!=1)throw new InvalidOperationException("CREATIVE_INVALID");
            if(data.nodes.Length+data.sounds.Length+data.clips.Length==0)return;
            var root=new GameObject("GamerHub Creative"); DontDestroyOnLoad(root);
            root.AddComponent<CreativeRuntime>().Load(data,resource.text);
        }
        private void Awake() { Instance=this; }
        public void Load(CreativeDocument data,string sourceJson=null)
        {
            Clear(); document=data; previous=new CreativeGameEvent { phase="ready" };clock=0; eventCount=0;
            using(var hash=SHA256.Create())contentHash="sha256-"+BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(sourceJson??JsonUtility.ToJson(data)))).Replace("-","").ToLowerInvariant();
            foreach(var node in data.nodes) {
                nodes.Add(node.id,node);
                var child=new GameObject(node.name??node.id);child.transform.SetParent(transform,false);objects.Add(node.id,child.transform);
                if(node.kind=="sprite") { var texture=Resources.Load<Texture2D>("Creative/"+node.assetId);if(texture==null)throw new InvalidOperationException("CREATIVE_TEXTURE_MISSING");textures[node.id]=texture; }
            }
            foreach(var node in data.nodes) if(!string.IsNullOrEmpty(node.parentId)) objects[node.id].SetParent(objects[node.parentId],false);
            foreach(var sound in data.sounds) {
                var source=gameObject.AddComponent<AudioSource>();source.playOnAwake=false;source.spatialBlend=0;source.loop=sound.loop;source.volume=sound.volume*data.masterVolume;
                source.clip=sound.source=="asset"?Resources.Load<AudioClip>("Creative/"+sound.assetId):Tone(sound.frequency,sound.duration);
                if(source.clip==null)throw new InvalidOperationException("CREATIVE_AUDIO_MISSING");
                if(sound.source!="asset")generated.Add(source.clip);sources.Add(sound.id,source);
            }
            RebuildPoses();
        }
        public static AudioClip Tone(float frequency,float duration)
        {
            const int rate=22050;var count=Mathf.Max(1,Mathf.RoundToInt(rate*Mathf.Clamp(duration,.03f,3)));
            var samples=new float[count];for(int i=0;i<count;i++){var envelope=Mathf.Min(1,Mathf.Min(i/(rate*.01f),(count-1-i)/(rate*.025f)));samples[i]=.25f*envelope*Mathf.Sin(2*Mathf.PI*Mathf.Clamp(frequency,80,2000)*i/rate);}
            var clip=AudioClip.Create("GamerHub tone",count,1,rate,false);if(!clip.SetData(samples,0))throw new InvalidOperationException("CREATIVE_TONE_FAILED");return clip;
        }
        public static float Sample(CreativeTrack track,float time)
        {
            var keys=track.keys;if(keys==null||keys.Length==0)throw new InvalidOperationException("CREATIVE_TRACK_EMPTY");
            if(time<=keys[0].time)return keys[0].value;
            for(int i=1;i<keys.Length;i++)if(time<=keys[i].time){if(track.property=="frame")return time==keys[i].time?keys[i].value:keys[i-1].value;return Mathf.Lerp(keys[i-1].value,keys[i].value,(time-keys[i-1].time)/(keys[i].time-keys[i-1].time));}
            return keys[keys.Length-1].value;
        }
        public CreativePose Pose(string id) => poses[id];
        public void Advance(float delta)
        {
            if(previous.phase=="paused"||!focused||float.IsNaN(delta)||float.IsInfinity(delta)||delta<0)return;
            clock+=delta;RebuildPoses();
        }
        private void RebuildPoses()
        {
            poses.Clear();foreach(var n in document.nodes)poses[n.id]=new CreativePose{id=n.id,x=n.x,y=n.y,width=n.width,height=n.height,rotation=n.rotation,opacity=n.opacity};
            foreach(var clip in document.clips)if(started.TryGetValue(clip.id,out var start)) {
                var t=clock-start;t=clip.loop?t%clip.duration:Mathf.Min(t,clip.duration);
                foreach(var track in clip.tracks){var p=poses[track.nodeId];var v=Sample(track,t);switch(track.property){case "x":p.x=v;break;case "y":p.y=v;break;case "width":p.width=v;break;case "height":p.height=v;break;case "rotation":p.rotation=v;break;case "opacity":p.opacity=v;break;case "frame":p.frame=v;break;}}
            }
            foreach(var p in poses.Values){objects[p.id].localPosition=new Vector3(p.x,p.y,0);objects[p.id].localRotation=Quaternion.Euler(0,0,p.rotation);}
        }
        public void Trigger(string eventName)
        {
            eventCount++;
            foreach(var clip in document.clips)if(clip.trigger==eventName)started[clip.id]=clock;
            foreach(var sound in document.sounds)if(sound.trigger==eventName){var source=sources[sound.id];source.Stop();source.Play();source.mute=muted||!focused;}
            RebuildPoses();
        }
        public static void Observe(string json) { if(Instance!=null)Instance.Accept(json); }
        public void Accept(string json)
        {
            var next=JsonUtility.FromJson<CreativeGameEvent>(json);if(next==null||string.IsNullOrEmpty(next.phase))return;
            if(next.phase=="ready" && previous.phase!="ready") { foreach(var source in sources.Values)source.Stop();started.Clear();clock=0;RebuildPoses(); }
            if(next.phase=="playing" && previous.phase!="playing" && previous.phase!="paused") {
                foreach(var source in sources.Values)source.Stop();started.Clear();clock=0;Trigger("start");
            }
            if(next.phase=="paused" && previous.phase!="paused")foreach(var source in sources.Values)source.Pause();
            if(next.phase=="playing" && previous.phase=="paused" && focused)foreach(var source in sources.Values)source.UnPause();
            if(previous.phase=="playing" && (next.total>previous.total||next.score>previous.score||next.kills>previous.kills))Trigger("score");
            if(previous.phase=="playing" && next.health<previous.health)Trigger("hit");
            if(next.phase!=previous.phase && (next.phase=="won"||next.phase=="lost")) {
                foreach(var source in sources.Values)if(source.loop)source.Stop();Trigger(next.phase=="won"?"win":"lose");
            }
            previous=next;
        }
        private void Update()
        {
            Advance(Time.unscaledDeltaTime);
            if(Input.GetMouseButtonDown(0) && previous.phase=="playing")Trigger("click");
            if(Input.GetKeyDown(KeyCode.M))SetMuted(!muted);
            if(Time.realtimeSinceStartup>=reportAt){reportAt=Time.realtimeSinceStartup+.1f;Report();}
        }
        public void SetMuted(bool value) { muted=value;foreach(var source in sources.Values)source.mute=value||!focused; }
        private void OnApplicationFocus(bool value) { focused=value;foreach(var source in sources.Values){source.mute=muted||!value;if(!value)source.Pause();else if(previous.phase!="paused")source.UnPause();} }
        private void OnGUI()
        {
            var matrix=GUI.matrix;var color=GUI.color;
            // GUI.depth belongs to this behaviour. Restoring zero here discards
            // its sort priority and lets the gameplay background cover the layer.
            GUI.depth=-100;GUI.matrix=Matrix4x4.Scale(new Vector3(Screen.width/960f,Screen.height/600f,1));
            foreach(var node in document.nodes)if(string.IsNullOrEmpty(node.parentId))Draw(node,1);
            if(document.sounds.Length>0){GUI.color=Color.white;if(GUI.Button(new Rect(876,574,78,24),muted?"声音关 M":"声音开 M"))SetMuted(!muted);}
            GUI.matrix=matrix;GUI.color=color;
        }
        private void Draw(CreativeNode node,float opacity)
        {
            if(!node.visible || (node.phase!="all" && node.phase!=previous.phase))return;
            var p=poses[node.id];var matrix=GUI.matrix;var color=GUI.color;
            GUI.matrix=matrix*Matrix4x4.TRS(new Vector3(p.x,p.y,0),Quaternion.Euler(0,0,p.rotation),Vector3.one);
            ColorUtility.TryParseHtmlString(node.color,out var tint);tint.a=opacity*p.opacity;GUI.color=tint;
            var rect=new Rect(-p.width/2,-p.height/2,p.width,p.height);
            if(node.kind=="rect")GUI.DrawTexture(rect,Texture2D.whiteTexture);
            else if(node.kind=="text"){
                var font=Resources.Load<Font>("Art/GameFont");var style=new GUIStyle(GUI.skin.label){alignment=TextAnchor.MiddleCenter,fontSize=Mathf.Clamp(Mathf.RoundToInt(p.height*.6f),10,80),wordWrap=true,richText=false};if(font!=null)style.font=font;style.normal.textColor=Color.white;
                while(style.fontSize>10 && style.CalcHeight(new GUIContent(node.text),p.width)>p.height)style.fontSize--;
                GUI.Label(rect,node.text,style);
            }
            else if(node.kind=="sprite"){
                var frame=Mathf.Clamp(Mathf.FloorToInt(p.frame),0,node.columns*node.rows-1);
                GUI.DrawTextureWithTexCoords(rect,textures[node.id],new Rect((frame%node.columns)/(float)node.columns,1-(frame/node.columns+1)/(float)node.rows,1f/node.columns,1f/node.rows));
            }
            foreach(var child in document.nodes)if(child.parentId==node.id)Draw(child,tint.a);
            GUI.matrix=matrix;GUI.color=color;
        }
        private void Report()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            int voices=0;foreach(var source in sources.Values)if(source.isPlaying)voices++;
            GamerHubCreativeState(JsonUtility.ToJson(new CreativeEvidence{phase=previous.phase,contentHash=contentHash,nodes=nodes.Count,clips=document.clips.Length,sounds=sources.Count,activeClips=started.Count,events=eventCount,voices=voices,time=clock,muted=muted,poses=new List<CreativePose>(poses.Values).ToArray()}));
#endif
        }
        private void Clear()
        {
            foreach(var source in sources.Values){source.Stop();Destroy(source);}sources.Clear();
            foreach(var clip in generated)Destroy(clip);generated.Clear();
            foreach(var child in objects.Values)if(child!=null)Destroy(child.gameObject);
            objects.Clear();textures.Clear();nodes.Clear();poses.Clear();started.Clear();
        }
        private void OnDestroy(){Clear();if(Instance==this)Instance=null;}
    }
}

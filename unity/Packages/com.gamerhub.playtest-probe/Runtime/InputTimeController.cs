using System;

namespace GamerHub.PlaytestProbe
{
    public sealed class InputTimeController
    {
        public int Tick { get; private set; }
        public bool Frozen { get; private set; }
        public int FixedDeltaTimeMs { get; }

        public InputTimeController(int fixedDeltaTimeMs = 20)
        {
            if (fixedDeltaTimeMs <= 0) throw new ArgumentOutOfRangeException(nameof(fixedDeltaTimeMs));
            FixedDeltaTimeMs = fixedDeltaTimeMs;
        }

        public void Freeze(bool frozen) => Frozen = frozen;
        public int Advance(int durationMs)
        {
            if (durationMs < 0) throw new ArgumentOutOfRangeException(nameof(durationMs));
            if (!Frozen) Tick += (int)Math.Ceiling(durationMs / (double)FixedDeltaTimeMs);
            return Tick;
        }
    }
}

using System;
using System.Collections.Generic;

namespace GamerHub.PlaytestProbe
{
    public sealed class StateObserver
    {
        private readonly Dictionary<string, Dictionary<string, object>> entities = new Dictionary<string, Dictionary<string, object>>();

        public void Set(string logicalId, string field, object value)
        {
            if (!PlaytestProbeContract.IsAllowedField(field)) throw new InvalidOperationException("FIELD_NOT_ALLOWED");
            if (!entities.TryGetValue(logicalId, out var state)) { state = new Dictionary<string, object>(); entities[logicalId] = state; }
            state[field] = value;
        }

        public IReadOnlyDictionary<string, object> Read(string logicalId)
        {
            if (!entities.TryGetValue(logicalId, out var state)) throw new KeyNotFoundException(logicalId);
            return new Dictionary<string, object>(state);
        }
    }
}

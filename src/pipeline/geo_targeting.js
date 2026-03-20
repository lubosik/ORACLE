// ============================================================
// ORACLE Geo Targeting
// Each group = one timezone. We accumulate city/state targets
// within a group until min_leads is reached, keeping every
// campaign hyper-targeted to a single geographic market.
// ============================================================

export const GEO_GROUPS = {
  uk: {
    id: 'uk',
    label: 'United Kingdom',
    country: 'United Kingdom',
    timezone: 'Europe/London',
    send_hours: { from: '08:00', to: '17:30' },
    targets: [
      { city: 'London' },
      { city: 'Manchester' },
      { city: 'Birmingham' },
      { city: 'Leeds' },
      { city: 'Bristol' },
      { city: 'Edinburgh' },
      { city: 'Glasgow' },
      { city: 'Liverpool' },
      { city: 'Sheffield' },
      { city: 'Nottingham' },
      { city: 'Leicester' },
      { city: 'Newcastle upon Tyne' },
      { city: 'Brighton' },
      { city: 'Oxford' },
      { city: 'Cambridge' },
      { city: 'Reading' },
      { city: 'Southampton' },
      { city: 'Cardiff' },
      { city: 'Coventry' },
      { city: 'Belfast' }
    ]
  },

  us_east: {
    id: 'us_east',
    label: 'US East Coast',
    country: 'United States',
    timezone: 'America/New_York',
    send_hours: { from: '08:00', to: '17:30' },
    targets: [
      { city: 'Miami' },
      { city: 'New York City' },
      { city: 'Atlanta' },
      { city: 'Boston' },
      { city: 'Philadelphia' },
      { city: 'Charlotte' },
      { city: 'Jacksonville' },
      { state: 'New York' },
      { state: 'Florida' },
      { state: 'Georgia' },
      { state: 'Massachusetts' },
      { state: 'Pennsylvania' },
      { state: 'New Jersey' },
      { state: 'Virginia' },
      { state: 'North Carolina' },
      { state: 'Michigan' },
      { state: 'Ohio' },
      { state: 'Maryland' },
      { state: 'Connecticut' },
      { state: 'South Carolina' },
      { state: 'Indiana' },
      { state: 'Tennessee' }
    ]
  },

  us_central: {
    id: 'us_central',
    label: 'US Central',
    country: 'United States',
    timezone: 'America/Chicago',
    send_hours: { from: '08:00', to: '17:30' },
    targets: [
      { state: 'Texas' },
      { state: 'Illinois' },
      { state: 'Minnesota' },
      { state: 'Missouri' },
      { state: 'Wisconsin' },
      { state: 'Louisiana' },
      { state: 'Oklahoma' },
      { state: 'Kansas' },
      { state: 'Iowa' },
      { state: 'Mississippi' },
      { state: 'Arkansas' },
      { state: 'Nebraska' }
    ]
  },

  us_west: {
    id: 'us_west',
    label: 'US West Coast',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    send_hours: { from: '08:00', to: '17:30' },
    targets: [
      { state: 'California' },
      { state: 'Washington' },
      { state: 'Oregon' },
      { state: 'Nevada' },
      { state: 'Alaska' },
      { state: 'Hawaii' }
    ]
  },

  us_mountain: {
    id: 'us_mountain',
    label: 'US Mountain',
    country: 'United States',
    timezone: 'America/Denver',
    send_hours: { from: '08:00', to: '17:30' },
    targets: [
      { state: 'Colorado' },
      { state: 'Arizona' },
      { state: 'Utah' },
      { state: 'New Mexico' },
      { state: 'Idaho' },
      { state: 'Montana' },
      { state: 'Wyoming' }
    ]
  }
};

// Rotation order — UK first, then US markets
export const GEO_ROTATION = ['uk', 'us_east', 'us_central', 'us_west', 'us_mountain'];

export function getGeoGroup(groupId) {
  return GEO_GROUPS[groupId] || GEO_GROUPS.uk;
}

export function nextGeoGroup(currentGroupId) {
  const idx = GEO_ROTATION.indexOf(currentGroupId);
  return GEO_ROTATION[(idx + 1) % GEO_ROTATION.length];
}

// Build a human-readable summary of which targets were used
export function buildGeoLabel(group, targetsUsed) {
  const names = targetsUsed.map(t => t.city || t.state);
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export const INSTANTLY_TIMEZONES = [
  'Etc/GMT+12', 'Etc/GMT+11', 'Etc/GMT+10', 'America/Anchorage', 'America/Dawson',
  'America/Creston', 'America/Chihuahua', 'America/Boise', 'America/Belize',
  'America/Chicago', 'America/Bahia_Banderas', 'America/Regina', 'America/Bogota',
  'America/Detroit', 'America/Indiana/Marengo', 'America/Caracas', 'America/Asuncion',
  'America/Glace_Bay', 'America/Campo_Grande', 'America/Anguilla', 'America/Santiago',
  'America/St_Johns', 'America/Sao_Paulo', 'America/Argentina/La_Rioja',
  'America/Araguaina', 'America/Godthab', 'America/Montevideo', 'America/Bahia',
  'America/Noronha', 'America/Scoresbysund', 'Atlantic/Cape_Verde', 'Africa/Casablanca',
  'America/Danmarkshavn', 'Europe/Isle_of_Man', 'Atlantic/Canary', 'Africa/Abidjan',
  'Arctic/Longyearbyen', 'Europe/Belgrade', 'Africa/Ceuta', 'Europe/Sarajevo',
  'Africa/Algiers', 'Africa/Windhoek', 'Asia/Nicosia', 'Asia/Beirut', 'Africa/Cairo',
  'Asia/Damascus', 'Europe/Bucharest', 'Africa/Blantyre', 'Europe/Helsinki',
  'Europe/Istanbul', 'Asia/Jerusalem', 'Africa/Tripoli', 'Asia/Amman', 'Asia/Baghdad',
  'Europe/Kaliningrad', 'Asia/Aden', 'Africa/Addis_Ababa', 'Europe/Kirov',
  'Europe/Astrakhan', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Baku', 'Indian/Mahe',
  'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Kabul', 'Antarctica/Mawson',
  'Asia/Yekaterinburg', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo',
  'Asia/Kathmandu', 'Antarctica/Vostok', 'Asia/Dhaka', 'Asia/Rangoon',
  'Antarctica/Davis', 'Asia/Novokuznetsk', 'Asia/Hong_Kong', 'Asia/Krasnoyarsk',
  'Asia/Brunei', 'Australia/Perth', 'Asia/Taipei', 'Asia/Choibalsan', 'Asia/Irkutsk',
  'Asia/Dili', 'Asia/Pyongyang', 'Australia/Adelaide', 'Australia/Darwin',
  'Australia/Brisbane', 'Australia/Melbourne', 'Antarctica/DumontDUrville',
  'Australia/Currie', 'Asia/Chita', 'Antarctica/Macquarie', 'Asia/Sakhalin',
  'Pacific/Auckland', 'Etc/GMT-12', 'Pacific/Fiji', 'Asia/Anadyr', 'Asia/Kamchatka',
  'Etc/GMT-13', 'Pacific/Apia',
  // European timezones
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna', 'Europe/Warsaw',
  'Europe/Prague', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen',
  'Europe/Zurich', 'Europe/Lisbon', 'Europe/Athens',
  'Europe/Sofia', 'Europe/Budapest', 'Europe/Kiev', 'Europe/Moscow',
  // US timezones — note: America/New_York is NOT in Instantly's list
  // Use America/Detroit (ET), America/Chicago (CT), America/Boise (MT), America/Anchorage (PT)
  'America/Detroit',    // Eastern Time — use this instead of America/New_York
  'America/Chicago',    // Central Time
  'America/Boise',      // Mountain Time
  'America/Anchorage',  // Pacific Time
  'America/Creston',    // Mountain Time (no DST)
];

// Map of common user-entered timezones to their correct Instantly equivalent
export const TIMEZONE_ALIASES = {
  'America/New_York':     'America/Detroit',
  'America/Los_Angeles':  'America/Anchorage',
  'America/Denver':       'America/Boise',
  'America/Phoenix':      'America/Creston',
  'US/Eastern':           'America/Detroit',
  'US/Central':           'America/Chicago',
  'US/Mountain':          'America/Boise',
  'US/Pacific':           'America/Anchorage',
  'EST':                  'America/Detroit',
  'CST':                  'America/Chicago',
  'MST':                  'America/Boise',
  'PST':                  'America/Anchorage',
  'GMT':                  'Europe/Isle_of_Man',
  'UTC':                  'Africa/Abidjan',
  'BST':                  'Europe/Isle_of_Man',
};

/**
 * Validate and resolve a timezone string to an Instantly-allowed value.
 * Returns { valid: true, timezone: '...' } or { valid: false, suggested: '...', message: '...' }
 */
export function resolveTimezone(input) {
  if (!input) return { valid: false, suggested: 'Europe/London', message: 'No timezone provided. Defaulting to Europe/London.' };

  // Exact match
  if (INSTANTLY_TIMEZONES.includes(input)) {
    return { valid: true, timezone: input };
  }

  // Check alias map
  if (TIMEZONE_ALIASES[input]) {
    const suggested = TIMEZONE_ALIASES[input];
    return {
      valid: false,
      suggested,
      message: `"${input}" is not a valid Instantly timezone. Using "${suggested}" instead. Note: America/New_York → America/Detroit (Eastern Time equivalent).`
    };
  }

  // Fuzzy match — find closest by string similarity
  const lower = input.toLowerCase();
  const fuzzy = INSTANTLY_TIMEZONES.find(tz => tz.toLowerCase().includes(lower.split('/')[1] || lower));
  if (fuzzy) {
    return {
      valid: false,
      suggested: fuzzy,
      message: `"${input}" is not valid for Instantly. Closest match: "${fuzzy}". Update your settings to use this value.`
    };
  }

  // Fallback
  return {
    valid: false,
    suggested: 'Europe/London',
    message: `"${input}" is not a valid Instantly timezone and no close match was found. Falling back to "Europe/London". Check the allowed timezone list in src/utils/timezones.js.`
  };
}

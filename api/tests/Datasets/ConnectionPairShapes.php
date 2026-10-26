<?php

/** Shared structural/projection expectations; timestamps and visibility are deliberately separate. */
dataset('connection pair shapes', [
    'absent' => [['state' => null, 'valid' => false, 'relationship' => 'none', 'accepted' => 0, 'incoming' => 0, 'find' => 1, 'repair' => 'unchanged']],
    'accepted' => [['state' => 'accepted', 'valid' => true, 'relationship' => 'accepted', 'accepted' => 1, 'incoming' => 0, 'find' => 0, 'repair' => 'unchanged']],
    'incoming' => [['state' => 'pending', 'valid' => true, 'relationship' => 'pending', 'accepted' => 0, 'incoming' => 1, 'find' => 0, 'repair' => 'unchanged']],
    'outgoing' => [['state' => 'pending', 'outgoing' => true, 'valid' => true, 'relationship' => 'pending', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unchanged']],
    'state mismatch' => [['state' => 'accepted', 'mirror_state' => 'declined', 'valid' => false, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'state']],
    'declined without initiator' => [['state' => 'declined', 'initiator' => null, 'valid' => true, 'relationship' => 'none', 'accepted' => 0, 'incoming' => 0, 'find' => 1, 'repair' => 'unchanged']],
    'blocked without initiator' => [['state' => 'blocked', 'initiator' => null, 'valid' => true, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unchanged']],
    'accepted missing connected time' => [['state' => 'accepted', 'missing_time' => true, 'valid' => true, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unchanged']],
    'pending missing request time' => [['state' => 'pending', 'missing_time' => true, 'valid' => true, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unchanged']],
    'missing mirror' => [['state' => 'accepted', 'missing_mirror' => true, 'valid' => false, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'mirror']],
    'missing required initiator' => [['state' => 'pending', 'initiator' => null, 'valid' => false, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unresolved']],
    'same stale blockers' => [['state' => 'accepted', 'stale_blocker' => true, 'valid' => false, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'clear']],
    'conflicting initiators' => [['state' => 'pending', 'conflicting_initiator' => true, 'valid' => false, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unresolved']],
    'conflicting blockers' => [['state' => 'blocked', 'conflicting_blocker' => true, 'valid' => false, 'relationship' => 'unavailable', 'accepted' => 0, 'incoming' => 0, 'find' => 0, 'repair' => 'unresolved']],
]);

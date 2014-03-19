module.exports = {
		FAIL_MODE: {
			FAILOVER: 'failover'
		,	FAILFAST: 'failfast'
		,	FAILSAFE: 'failsafe'
		, FAILBACK: 'failback'
	}
	,	SCHEDULE: {
			ROUNDROBIN: 'rr'
		,	WEIGHT_ROUNDROBIN: 'wrr'
		, LEAST_ACTIVE: 'la'
		, CONSISTENT_HASH: 'ch'
	}
	, DEFAULT_PARAM: {
			FAILOVER_RETRIES: 2
		, FAILBACK_SEND_INTERVAL: 10 * 1000
		, FAILBACK_RETRIES: 5
		, GRACE_TIMEOUT: 3000
		, DEFAULT_PENDING_SIZE: 1000
	}
};
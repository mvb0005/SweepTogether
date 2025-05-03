# Minesweeper Infinite TODO

## Integration Tests as Sidecar

✅ Created dedicated integration test container infrastructure:
- `Dockerfile.integration-tests` - Containerized integration test environment
- `integration-tests/run-tests.sh` - Test runner with configurable parameters
- `docker-compose.sidecar-tests.yml` - Example deployment with sidecar tests

### How to Use Integration Tests

The integration test container can be deployed as a sidecar alongside your application to ensure deployed code is working properly. Key features:

1. **Standalone Container**: Tests run in an isolated environment
2. **Configurable**: Set target URL, retry parameters, and test patterns via environment variables
3. **Health Checks**: Waits for application readiness before running tests
4. **Reporting**: Generates HTML test reports in the mounted volume

### Running the Tests

```bash
# Run the full stack with integration tests
docker-compose -f docker-compose.sidecar-tests.yml up
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| TARGET_URL | URL of the app to test | http://nginx:80 |
| RETRY_COUNT | Number of attempts to connect | 3 |
| RETRY_INTERVAL | Seconds between retries | 10 |
| TEST_PATTERN | Glob pattern for test files | **/*.spec.js |
| REPORT_PATH | Path for test reports | /app/reports |
| DEBUG | Enable verbose output | false |

### Deployment Options

1. **One-time Validation**: Run tests once after deployment
2. **Scheduled Testing**: Keep container running and test on schedule
3. **CI/CD Integration**: Use as part of deployment pipeline

### Future Enhancements

- [ ] Add Prometheus metrics endpoint to expose test results
- [ ] Implement Slack/Teams notifications for test failures
- [ ] Add more comprehensive application tests
- [ ] Configure for Kubernetes deployment with helm chart
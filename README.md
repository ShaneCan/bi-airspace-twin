# Bi-Airspace Twin

A web-based viewer for **bigrids** (bi-spatial structures).
It provides an interactive 3D environment for exploring bigrid based airspace.

### Features

- **2D/3D Bigrid Generation**
    - Load sample models
    - Upload custom XMI files
    - Generate grids via the `bigrid-provider-service`
    - Fetch from a CDO repository

- **Live Monitoring**
    - Visualize simulated or physical Crazyflie drone positions as a colored drone
      (via [
      `cf.PyControl` WebSocket integration](https://github.com/UniAgent-CyberPhysicalAssets/cps.asset.crazyflie/tree/main/controller/cf.PyControl))

- **3D Navigation**
    - Free-flight camera

**Screenshots**

|<img src="docs/screenshot-1.png" width="300"/>|<img src="docs/screenshot-2.png" width="300"/>|
|-|-|



## Getting Started

**Start the Web App:**

```shell
$ nvm install node --lts
$ nvm use --lts 
$ npm install
$ npm run dev
```

Open the browser at:
[`http://localhost:5173/`](http://localhost:5173/)

Press <kbd>ESC</kbd> to leave the 3D view and take back control.

### More Functions

- Start the [bigrid-provider-service](https://github.com/UniAgent-Platform/bigrid-provider-service) if you plan to
  generate grids dynamically.
- Start the CDO server if you want to load models from a CDO repository.
  See [here](https://github.com/bigraph-toolkit-suite/bigraphs-by-examples.vendingmachine-webservice/blob/main/src/test/java/org.example/CDOStandaloneServerTest.java)
  and [here](https://github.com/bigraph-toolkit-suite/bigraphs-by-examples.vendingmachine-webservice/blob/main/src/main/java/org/example/service/CDOServerService.java)
  for example.
- The ROS connector relies on [Crazyswarm2](https://github.com/UniAgent-CyberPhysicalAssets/cps.asset.crazyflie/tree/main/simulation/crazyswarm2-ext) and the [JAVA rosbridge](https://github.com/RobotWebTools/rosbridge_suite). Check the tutorial [here](https://bigraphs.org/software/bigraph-framework/tutorials/streamattributes/#prerequisites).
```shell
$ ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

If these services are not running, some features may be unavailable, but the application will still start and all
offline functionality will work normally.

### Configuration

**bigrid-provider-service**

- Change URL+Port: `vite.config.ts`

## How to Create Bigrids?

Use:

- [bigrid-provider-service](https://github.com/UniAgent-Platform/bigrid-provider-service)
- [bigraphs.model-provider](https://github.com/bigraph-toolkit-suite/bigraphs.model-provider)
- [Bigraph Framework](https://github.com/bigraph-toolkit-suite/bigraphs.bigraph-framework)
- [Bigellor](https://github.com/bigraph-toolkit-suite/bigraphs.ide.bigellor)

Create your own:
The [signature of bigrids](https://github.com/bigraph-toolkit-suite/bigraphs.model-provider/blob/main/src/main/java/org/bigraphs/model/provider/spatial/signature/BiSpaceSignatureProvider.java)
is very simple and their [usage](https://uniagent-cyberphysicalassets.github.io/cps.asset.crazyflie/31-drone-equations)
as well.
The file parsing logic lives in
[`BigraphGridXMLParser.js`](src/BigraphGridXMLParser.js).
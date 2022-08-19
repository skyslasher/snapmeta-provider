# Volumio metadata provider for Snapcast

This plugin enables the [Snapcast](https://github.com/badaix/snapcast) server
to control [Volumio](https://volumio.com/) and provides the metadata of the
current playing song.

*Please note that the audio connection to Snapcast is not established by this
plugin.* You can use e.g. Pulse Audio to bridge the audio stream to the
Snapcast server or use a loopback device. I personally run Volumio in a LXC
container and use a loopback device that is passed from the host running
Snapcast to the container running Volumio.

## Installation

If your Volumio player is not reachable via the hostname `volumio.local`,
please substitute its adress in the commands below.

* Enable ssh access on your Volumio instance:
Point your Browser to
```plain_text
 http://volumio.local/dev
 ```
Go to the section *SSH* and click the `ENABLE` button
* ssh into your Volumio instance:
```plain_text
$ ssh volumio@volumio.local
 ```
* Download the ZIP archive and unzip it in your home folder
* Change to the unzipped plugin directory
* Install the plugin with
```plain_text
$ volumio plugin install
 ```
## Configuration

### Volumio
Navigate to *Plugins -> Installed Plugins* and enable the plugin. Then click
on the `Settings` button.

* `Host/IP`: Leave blank to make the plugin listen on all adresses on
all interfaces
* `Port`: The port number Snapcast will connect to
* `HTTP Base URL`: To enable Snapcast to download cover art from volumio, we
need the first part of the URL to reach your Volumio instance, e.g.
`http://volumio.local`

### Snapcast server

Copy the control script `volumioctl.sh` from the plugin subdirectory
`snapserver/etc/plugins/` to the directory `/usr/share/snapserver/plug-ins`
on the Snapcast server. Adjust the `nc` command parameters with the hostname
of your Volumio instance (HTTP Base URL without `http://`, e.g. `volumio.local`)
and with the port number entered in the plugin config.

In the server config file `/etc/snapserver.conf`, find the stream that serves
the Volumio audio and add the parameter `&controlscript=volumioctl.sh`. Restart
Snapserver with `sudo systemctl restart snapserver`.

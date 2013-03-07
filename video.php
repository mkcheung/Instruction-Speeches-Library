<?php
require_once("DatabaseObject.php");

class Video extends DatabaseObject{


	protected static $tablename = 'videos';
	protected static $attributes = array('name', 'size', 'type', 'temp_name');

	public $name;
	public $size;
	public $type;
	public $temp_name;

	public static function loadVideo($videoName, $videoSize, $videoType, $videoTempName){

		global $db;
		$Object = new static;

		$Object->name = $videoName;
		$Object->size = $videoSize;
		$Object->type = $videoType;
		$Object->temp_name = $videoTempName;

		return $Object;
	}
}

?>



<?php
include_once("footer.php");
?>
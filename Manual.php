<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("function.php");
require_once("Session.php");
// include_once("header.php");

class Manual extends DatabaseObject{
	protected static $tablename = 'manuals';
	protected static $attributes = array('id', 'description');

	public $id;
	public $description;

	public static function newManual($description){
		$Object = new static;
		$Object->description = $description;

		return $Object;
	}
}
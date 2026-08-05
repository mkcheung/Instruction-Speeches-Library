<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("userrole.php");
// include_once("header.php");

class Category extends DatabaseObject{

	protected static $tablename = "categories";
	protected static $attributes = array('id', 'manual_id', 'category_title', 'category_description');

	// class members
	public $id;
	public $manual_id;
	public $category_title;
	public $category_description;

	public static function newCategory($manual_id, $title, $description){
		global $db;

		$Object = new static;

		$Object->manual_id = $manual_id;
		$Object->category_title = $title;
		$Object->category_description = $description;

		return $Object;
	}

} // end Category

?>